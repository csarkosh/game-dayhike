# test-rig-scaleway-mac: rented Apple silicon Macs, by the day

> ## STATUS: INCOMPLETE. Never applied. Do not apply it as it is.
>
> Written on 2026-09-27 and set aside: Scaleway had no macOS machine of any type in stock
> (`M4-S` and every other macOS type answered `no_stock` on 2026-09-28 and 2026-09-29), and
> the game's reference measurements went on using the development Mac. **Nothing in any cloud
> account was ever created by this module.** `terraform plan` and `apply` refuse to run until
> `acknowledge_incomplete = true` is passed, so that it cannot be applied by accident.
>
> **Where it stands**
>
> - Written: the module, the set-up script, the first day's probe, and the script that asks
>   Scaleway's API directly.
> - Checked: `terraform validate` passes; `terraform plan` was run without credentials only
>   (one Mac: three creations beside the key).
> - Never run against a real account: `apply`, `setup.sh`, `probe.sh`, `scaleway-macs.sh`.
>
> **Known gaps, to close before a first apply**
>
> 1. This README says a Mac whose creation failed is guarded when it is replaced. No such
>    guard exists: that replacement is not held to the 24 hours and is not scheduled for
>    deletion. Either build the guard or take the claim out and say what to do by hand.
> 2. The `curl` calls in `scaleway-macs.sh` and `setup.sh` have no time limits.
> 3. `scaleway-macs.sh list` with a wrong project id lists nothing and reports all clear; it
>    must fail when the project cannot be read.
> 4. `setup.sh` runs a package install before its privileged steps end: an install script
>    could put a `sudo` earlier in `PATH` or replace the askpass helper. Pin `PATH` and do the
>    privileged steps first.
> 5. A macOS update that rewrites `/etc/pf.conf` would reopen the Mac with nothing saying so:
>    check the firewall's rules from outside at the start of every day, not only after set-up.
> 6. The checks that a port is closed can pass for the wrong reason (a machine that does not
>    answer at all reads as closed).
> 7. The firewall's loopback rule keeps state; it should not.
> 8. `probe.sh` does not read the navigation's error text, and its fixed DevTools port could
>    attach to a browser left running.
>
> **What only a real machine can settle** (the reason the first day uses ONE Mac, about
> EUR 5.28 for its 24 hours)
>
> - Whether a browser gets the GPU with nobody at the screen, and whether automatic login can
>   be turned on by script over SSH.
> - Whether a Mac's earliest deletion time is 24 hours after its creation. In every answer
>   recorded in the provider's own tests the two times are EQUAL; if real accounts behave so,
>   a scheduled deletion could fire right after delivery. The scheduler refuses unless the
>   gap is at least 23.5 hours, so this shows as a refusal, not as a lost machine.
> - What Scaleway answers to a delete sent before the 24 hours are up.
> - How long a create takes (the module waits up to 120 minutes).
>
> **To pick it up**
>
> 1. Ask Scaleway's API whether an `M4-S` is in stock (`scaleway-macs.sh` shows how the API is
>    called; the account needs a payment method and a verified identity, both done on
>    2026-09-28).
> 2. Close the gaps above; read the module's `main.tf`, `setup.sh` and `scaleway-macs.sh`
>    (in `_infra/modules/scaleway-test-rig-mac/`) whole first.
> 3. `terraform init`, then `terraform plan -var acknowledge_incomplete=true` with
>    `server_count = 1`; read the plan; then the first day as "The first day" below describes.
> 4. At the end of the day run `scaleway-macs.sh list` and compare it with Terraform's state:
>    the state is not a record of what is billed (below).
> 5. When a day has been run and the gaps are closed, take this block and the
>    `acknowledge_incomplete` variable out.
>
> **What it cannot touch.** It is a root module of its own, with a state of its own (prefix
> `test-rig-mac`) and one provider, Scaleway's; its resources are in
> `_infra/modules/scaleway-test-rig-mac/`, which only this directory calls. It reads no output, state or variable of
> `_infra/` (hosting, DNS, the signaling service), of `_infra/test-rig-aws-windows/` (the Windows machine
> on AWS) or of `_infra/test-rig-gcp-windows/` (the one on Google Cloud), and none of them reads it.
> Running Terraform in any of those never loads a file of this directory.

Mac minis rented from Scaleway, so the game's frame-time measurements can run on Apple
silicon without the development machine, and on two Macs in parallel. Apple's macOS licence
makes 24 hours the shortest rental, so the unit here is a **day**, not an hour: create the Macs
in the morning, measure, and they are deleted 24 hours after creation.

This is its own Terraform root module with its own state (`gs://fps-csarko-tfstate`, prefix
`test-rig-mac`). It shares nothing with `_infra/`, `_infra/test-rig-aws-windows/` or `_infra/test-rig-gcp-windows/`: a day's create
and destroy never reads or writes a Windows machine's state, and none of them can touch
hosting.

The resources themselves, and the two scripts they run (`setup.sh`, `scaleway-macs.sh`), are in
[`_infra/modules/scaleway-test-rig-mac/`](../modules/scaleway-test-rig-mac/), as `_infra/`'s own
resources are in `_infra/modules/`. This directory is the root that calls it: the backend, the
provider, one `module "test_rig"` call, and the variables (with `acknowledge_incomplete`) and
outputs passed through. Every command below runs here, and a resource's address carries the
call's name: `module.test_rig.scaleway_apple_silicon_server.mac[0]`. It is not called from
`_infra/main.tf`: this state holds each Mac's admin password in clear text, which hosting's
state must never hold.

**Terraform's state is not a record of what is billed.** The Scaleway provider treats a `403`
answer, to a read as well as to a delete, as "the server is gone" and forgets it, while the Mac
may still exist and bill. `scaleway-macs.sh list`, which asks Scaleway's API directly, is the
record; the end of every day runs it (below).

## What it defines

Resources and data sources are the module's, at `module.test_rig.<address>`; so are the two
scripts, in `../modules/scaleway-test-rig-mac/`.

| Resource or file | Why |
|---|---|
| `scaleway_apple_silicon_server.mac` × `server_count` | `M4-S` Mac minis in `fr-par-1`, named `test-rig-01`, `test-rig-02`, on Scaleway's default macOS and the hourly plan. The create may take up to 120 minutes (a non-default macOS takes about an hour). |
| `scaleway_iam_ssh_key.login` | The public key from `ssh_public_key`. Scaleway installs a **project's** SSH keys on each Mac at delivery (its `scw-agent` keeps them current), so the key is registered at project level, not per server. |
| `terraform_data.delete_guard` × `server_count` | Refuses to let `terraform destroy` (or a replacement) delete a Mac before its 24 hours are up. |
| `terraform_data.auto_delete` × `server_count` | Asks Scaleway to delete each Mac by itself at 24 hours, and confirms it. |
| `terraform_data.setup` (off by default) | Runs `setup.sh` against each Mac as part of `apply`. |
| `scaleway-macs.sh` | Talks to Scaleway's API directly: schedules deletion (called by `apply`), lists every Mac in the project against Terraform's state, and sends one early delete for the first day's test. |
| `setup.sh`, `probe.sh` | Set-up and the first day's probe, below. |

Neither Scaleway resource accepts tags; the `test-rig-` name prefix identifies them in the
console and on the invoice. Not defined: DNS, load balancers, private networks and bandwidth
upgrades, all of which bill by the month. `macos` is read when a Mac is created: changing it
later does nothing to a Mac that exists.

### The machine

`M4-S` is a Mac mini M4: 10 CPU cores, a 10-core GPU, 16 GB, a 256 GB SSD, and a fan. The
development machine is a MacBook Air M4 with an 8-core GPU and no fan, which slows under
sustained load. The two will not produce the same numbers, and neither will two Mac minis
exactly: **builds are compared against each other on one machine, never across machines.**

Scaleway's server-type listing names **macOS Tahoe 26.6.1** as the M4-S default today (the
development machine runs 26.6.2). A default-OS Mac is delivered in minutes; any other version
(`-var macos=<name>`) takes about an hour.

## What a day costs

Scaleway's public catalogue, 2026-09-27: `M4-S` costs **EUR 0.22 an hour**, excluding VAT
(which Scaleway does not charge a customer outside the EU). A Mac is billed from creation
until deletion, running, shut down or idle alike, with a 24-hour minimum.

| Macs | One day (24 h) |
|---|---|
| 1 | 24 × 0.22 = **EUR 5.28** |
| 2 | **EUR 10.56** |
| 3 | **EUR 15.84**, once Scaleway has raised the quota (below) |

A Mac nobody deletes bills about **EUR 160 a month**. `terraform output day_cost` prints the
figures for the current `server_count`.

### Only deletion stops the bill

Shutting a Mac down does not stop its bill; only deleting it does. Three things stand between a
forgotten Mac and a month's charge:

- **Deletion at 24 hours** (`auto_delete`). With `auto_delete_after_24h` (on by default),
  `apply` asks Scaleway to delete each Mac by itself at its earliest deletion time (the API's
  `schedule_deletion`, which the Scaleway console offers as "automatic deletion"), then reads
  the Mac back and checks that the deletion is scheduled. It refuses, and schedules nothing, if
  Scaleway's earliest deletion time is less than 23.5 hours after creation: every response
  recorded in the provider's own tests has the two equal, and a scheduled deletion would then
  fire right after delivery while the day is billed anyway. A refusal or a failed call fails
  the `apply`; the next `apply` retries it. Turning the switch off cannot unschedule a
  deletion already requested; turning it on schedules the Macs that exist.
- **No delete before the 24 hours** (`delete_guard`). Scaleway documents that a Mac cannot be
  deleted before its earliest deletion time, but not how the API refuses, and the provider
  turns a `403` refusal into "deleted" and forgets the Mac. So `terraform destroy`, or any
  change that replaces a Mac (a new type or zone, a lower `server_count`), stops before touching
  any Mac until 24 hours after its creation plus 10 minutes, taken as the later of Scaleway's
  `deletable_at` and creation + 24 h. It also stops if either time cannot be read.
- **The end-of-day listing** (`scaleway-macs.sh list`, below), which catches what the first
  two cannot: a Mac Terraform has forgotten.

Both guards are replaced whenever their Mac is, so a Mac re-created on a later day, or for a
new type or zone, always gets fresh ones. Deletion takes Scaleway about 30 minutes to complete.

**If a create fails** (a timeout, an API error), the Mac may still have been ordered and be
billing: the provider records a server as soon as Scaleway accepts the order, and marks it
tainted, and neither guard exists for it yet. Before anything else, run
`../modules/scaleway-test-rig-mac/scaleway-macs.sh list` and look in the Scaleway console. The next `apply` would replace the
tainted Mac, and the guard stops that until its 24 hours are up.

## Before the first day, once, by hand

1. **Payment method and identity.** Scaleway's quota table allows `M4-S` only to an
   organization that has **both** validated a payment method **and** verified its identity
   (a government photo ID and a face check, in the console under Organization → Verify your
   identity), and then allows **2 per availability zone**. Until then the API lists every
   Apple silicon type as `no_stock` (the values it can take are `no_stock`, `low_stock` and
   `high_stock`); whether that reflects the account's missing verification or real stock,
   Scaleway does not say, so check again once the organization is verified: `low_stock` or
   `high_stock` for `M4-S` in `fr-par-1` means a Mac can be ordered. More than two Macs at once
   needs a quota increase: open a ticket with Scaleway support (console, Support), then raise
   the limit in `server_count`'s validation in `variables.tf` to match.
2. **An API key limited to this module.** Rather than a key tied to a person's own user
   account, create an IAM application (IAM → Applications) with a policy scoped to the one
   project, holding the permission sets `AppleSiliconFullAccess` and `SSHKeysFullAccess`, and
   create the API key for that application.
3. **The environment**, in the shell that runs Terraform, never in a file in the repository:
   `SCW_ACCESS_KEY`, `SCW_SECRET_KEY`, `SCW_DEFAULT_PROJECT_ID`, `SCW_DEFAULT_ORGANIZATION_ID`.
   `scaleway-macs.sh` needs `SCW_SECRET_KEY` from the environment too (not only from a `scw`
   configuration file). Google application-default credentials are needed for the state bucket.
4. **`terraform.tfvars`** (git-ignored), copied from `terraform.tfvars.example`, with
   `ssh_public_key` set. If the same key is already registered in the Scaleway project,
   delete it there first: a project cannot hold the same key twice.
5. `node`, `curl` and `nc` on this machine.

## A test day

```bash
cd _infra/test-rig-scaleway-mac
terraform init                               # once
terraform apply                              # morning: rent the Mac; delivery takes minutes
terraform output macs                        # address, login, Screen Sharing port, earliest deletion

# Set up each Mac straight away (about 15 minutes each; they can run side by side). Until
# then it accepts password logins over SSH and Screen Sharing.
TEST_RIG_PASSWORD="$(terraform output -json passwords | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0]')" \
TEST_RIG_VNC_PORT="$(terraform output -json macs | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0].vnc_port')" \
  ../modules/scaleway-test-rig-mac/setup.sh --to <username>@<ip>

# The first day: the probe, below. Then measure.

../modules/scaleway-test-rig-mac/scaleway-macs.sh list   # end of the day: every Mac scheduled, none unknown
terraform destroy                            # after earliest_delete, even if Scaleway has already
                                             # deleted the Macs, so that state lists none
```

Never paste `terraform show`, `terraform state show` or a plan into a ticket or a chat: they
print each Mac's password in clear (below).

If `ssh` reports that the host key has changed, the address belonged to an earlier Mac: run
`ssh-keygen -R <ip>` and connect again.

### Set-up

`setup.sh --to` runs on this machine. It first proves that key login works, on its own SSH
connection with `BatchMode`, before anything on the Mac changes; then sends the Mac user's
password and the script over one SSH connection and runs it on the Mac; then waits for the Mac
to come back from its restart and checks it **from outside**:

- the user is logged in at the console (automatic login worked);
- port 22 answers, and the Screen Sharing port, 5900 and 3283 do not (unless `allow_vnc`);
- `pf` is enabled with this module's rules loaded;
- sshd offers no password or keyboard-interactive login.

Any mismatch fails with a message. On the Mac, set-up is idempotent step by step and logs to
`~/test-rig/setup.log`:

1. **Access first.** SSH by key only (`/etc/ssh/sshd_config.d/000-test-rig.conf`, installed
   only if `sshd -t` accepts it and rolled back if not). The packet filter `pf` lets in SSH (and
   ICMP, DHCP and IPv6 neighbour discovery, which the network needs) and nothing else. The rules
   live in a `test-rig` anchor referenced from `/etc/pf.conf`, so Apple's own loader at boot and
   this module's load the same rules in whichever order they run, and a launch daemon enables
   `pf` at every boot with `pfctl -E`. SSH is passed without state, so turning `pf` on cannot
   drop the connection running set-up. Scaleway's image has SSH, Screen Sharing on a randomly
   chosen port watched by `fail2ban`, and `scw-agent`, which needs no inbound port. Screen
   Sharing stays closed unless `allow_vnc` is set.
2. **Software.** Chrome stable (not pinnable: Google serves only the current build; its
   signature and Google's team id are checked, and the version logged), Node 22.13.1 (the
   development machine's), Git LFS 3.8.0, both checked by SHA-256 into `~/test-rig`, and the
   `chrome-devtools` command-line tool from `chrome-devtools-mcp@1.8.0` (the development
   machine's; 1.10.1 is the newest). Git comes with the Xcode Scaleway preinstalls. Direct
   downloads rather than Homebrew, so nothing else is installed.
3. **A logged-in desktop with nobody at the screen.** FileVault must be off for automatic login
   and for any remote access after a restart: set-up reports it and stops if it is on, and
   turns nothing off. Automatic login uses macOS's own mechanism (`autoLoginUser` and
   `/etc/kcpassword`). Display sleep, system sleep and the screen saver are turned off. The
   screen lock is left alone: it only follows the screen saver or display sleep, both off, and
   turning it off would need the password on a command line.
4. **The repository**, cloned with its LFS assets at `TEST_RIG_REF` (default `main`), then
   `npm ci`.

Then one restart. `run_setup_from_terraform` makes `apply` do all of this; it is off by default
until a first day has shown the script working on Scaleway's image, because run by hand its
output is in front of you, it can be stopped, and each Mac can be rerun on its own. (Run from
Terraform, its whole output is hidden, since its environment holds the password.)

### The password

Scaleway creates each Mac's user with a random password, which the API returns to any key that
can read the project, and the Terraform provider stores as `password`. It is needed for `sudo`
and for automatic login, and where it goes is:

- **Terraform state, in clear text**, in `gs://fps-csarko-tfstate/test-rig-mac/` and in every
  older version of that object the bucket keeps. The provider stores it twice: in `password`
  (marked sensitive, which only hides it from Terraform's screen output) and inside `vnc_url`
  (not marked sensitive, so `terraform show` prints it; the outputs here carry only the port).
  A saved plan file holds it too (plan files are git-ignored). This cannot be avoided with this
  provider. The bucket is private, and a password stops meaning anything once its Mac is
  deleted at the end of the day.
- `terraform output -json passwords` → an environment variable of the local `setup.sh` process
  (not the shell history: the history holds the command, not its output) → the first line of the
  SSH connection's standard input → a shell variable in the script on the Mac, kept out of the
  environment of everything the script runs → `sudo`, through an askpass helper that is handed
  it alone. Never on a command line on either machine, never in a file in the clear, never in a
  log.
- `/etc/kcpassword` on the Mac, which is how macOS itself stores an automatic-login password:
  created readable only by root, and obfuscated, not encrypted. It is deleted with the Mac.

## The first day's probe

The first day rents **one** Mac (**EUR 5.28**). A second, for the spread between two machines
(probe 2), is worth renting once probe 1 has shown that Chrome gets the GPU.

1. **Does Chrome get the GPU?**

   ```bash
   TEST_RIG_PASSWORD="..." ./probe.sh --to <username>@<ip>          # as for setup.sh
   ```

   It reports macOS, Chrome's version, whether the desktop is logged in, the displays macOS
   reports (`system_profiler SPDisplaysDataType` and the `ioreg` display entries), and then
   starts Chrome three ways: from the SSH shell headless, and inside the logged-in desktop
   headless and in a window. Getting into the desktop from SSH needs root: `sudo launchctl
   asuser <uid> sudo -u <user>`, with the password reaching `sudo` as in set-up. For each it
   prints the WebGL2 unmasked renderer (the development machine reads `ANGLE (Apple, ANGLE Metal
   Renderer: Apple M4, Unspecified Version)`), the WebGPU adapter, the screen size Chrome sees
   and its frame interval. A run that fails prints a FAIL line, and the probe fails if the
   windowed run inside the desktop fails. Headless Chrome always draws to an 800 × 600 screen at
   60 frames a second, so only the windowed run tells what display the Mac has; it runs with
   Chrome's occluded-window and background throttling off, so a hidden window is not mistaken
   for a missing display. Scaleway documents nothing about a display on its Macs; if macOS
   reports none, or the windowed run is capped at 60 or 30 Hz, ask Scaleway support whether an
   HDMI display emulator is fitted, and meanwhile measure with Chrome's `--disable-gpu-vsync
   --disable-frame-rate-limit` so the display does not set the frame time.
2. **How steady is it?** `./probe.sh --to <username>@<ip> <url> 60` also loads the page at
   `<url>` in a window and records 60 seconds of frame intervals, twice. On one Mac, the spread
   between the two runs is the noise any later difference has to beat; with a second Mac on a
   later day, the spread between the two Macs.
3. **What does an early delete do?** Some hours into the day, send one delete straight to the
   API, not through Terraform (where a refusal would read as success):

   ```bash
   ../modules/scaleway-test-rig-mac/scaleway-macs.sh try-early-delete fr-par-1 <server-id>   # the id after "fr-par-1/"
   ```

   It prints the HTTP status and body. A refusal (a `4xx`) is the expected answer and changes
   nothing. A `2xx` means the Mac is being deleted early: the next invoice shows whether the
   full day was billed, and `terraform apply` afterwards would see it gone.

## When a Mac is unreachable

`pf` is reloaded at every boot, so a restart from the Scaleway console does not undo a
firewall mistake. If SSH still works, Screen Sharing is reachable through it, since `pf` passes
the loopback: `ssh -L 5901:localhost:<vnc_port> <username>@<ip>`, then connect a Screen Sharing
client to `localhost:5901`. If SSH does not work, the way back is the console's
**Reinstall**, which wipes the Mac to Scaleway's stock macOS on the same server (the day's clock
keeps running); then run `setup.sh --to` again.
