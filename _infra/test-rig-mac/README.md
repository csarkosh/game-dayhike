# test-rig-mac: rented Apple silicon Macs, by the day

Mac minis rented from Scaleway, so the game's frame-time measurements can run on Apple
silicon without the development machine, and on several Macs in parallel. Apple's macOS
licence makes 24 hours the shortest rental, so the unit here is a **day**, not an hour: create
the Macs in the morning, measure, and they are deleted 24 hours after creation.

This is its own Terraform root module with its own state (`gs://fps-csarko-tfstate`, prefix
`test-rig-mac`). It shares nothing with `_infra/` or `_infra/test-rig/`: a day's create and
destroy never reads or writes the Windows machine's state, and neither can touch hosting.

## What it defines

| Resource | Why |
|---|---|
| `scaleway_apple_silicon_server.mac` × `server_count` | `M4-S` Mac minis in `fr-par-1`, named `test-rig-01`, `test-rig-02`, …, on Scaleway's default macOS and the hourly plan. |
| `scaleway_iam_ssh_key.owner` | The public key from `ssh_public_key`. Scaleway installs a **project's** SSH keys on each Mac at delivery (its `scw-agent` keeps them current), so the key is registered at project level, not per server. |
| `terraform_data.day_guard` × `server_count` | The two guards against a surprise bill, below. |
| `terraform_data.setup` (off by default) | Runs `setup.sh` against each Mac as part of `apply`. |

Neither Scaleway resource accepts tags; the `test-rig-` name prefix identifies them in the
console and on the invoice. Not defined: DNS, load balancers, private networks and bandwidth
upgrades, all of which bill by the month.

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
| 3 | **EUR 15.84** (needs a quota increase; see below) |

`terraform output day_cost` prints the figure for the current `server_count`.

### Only deletion stops the bill

Shutting a Mac down does not stop its bill; only deleting it does. Two guards stand between a
forgotten Mac and a month's charge:

- **Deletion at 24 hours.** With `auto_delete_after_24h` (on by default), `apply` asks
  Scaleway to delete each Mac by itself at its earliest deletion time (the API's
  `schedule_deletion`, which the Scaleway console offers as "automatic deletion"). A Mac
  nobody destroys then costs exactly its day.
- **No destroy before the 24 hours.** Scaleway documents that a Mac cannot be deleted before
  its earliest deletion time (`earliest_delete` in `terraform output macs`), but not how the
  API refuses. The Terraform provider treats a `403` answer to a delete as success and removes
  the server from its state, which would leave a Mac billing with no record of it here. So
  `terraform destroy` inside the 24 hours stops before touching any server, with the time it
  may run again. Whether the API refuses an early delete, or accepts it and bills the full
  day, is not documented; the first day's probe finds out.

Deletion takes Scaleway about 30 minutes to complete.

## Before the first day, once, by hand

1. **Payment method and identity.** Scaleway's quota table allows `M4-S` only to an
   organization that has **both** validated a payment method **and** verified its identity
   (a government photo ID and a face check, in the console under Organization → Verify your
   identity), and then allows **2 per availability zone**. More than two at once needs a
   request to Scaleway support. Until then the API lists every Apple silicon type as
   `no_stock` (the values it can take are `no_stock`, `low_stock` and `high_stock`); whether
   that reflects the account's missing verification or real stock, Scaleway does not say, so
   check again once the organization is verified: `low_stock` or `high_stock` for `M4-S` in
   `fr-par-1` means a Mac can be ordered.
2. **An API key limited to this module.** Rather than a key tied to the owner's own user, create
   an IAM application (IAM → Applications) with a policy scoped to the one project, holding the
   permission sets `AppleSiliconFullAccess` and `SSHKeysFullAccess`, and create the API key for
   that application.
3. **The environment**, in the shell that runs Terraform, never in a file in the repository:
   `SCW_ACCESS_KEY`, `SCW_SECRET_KEY`, `SCW_DEFAULT_PROJECT_ID`, `SCW_DEFAULT_ORGANIZATION_ID`.
   Google application-default credentials are needed too, for the state bucket.
4. **`terraform.tfvars`** (git-ignored), copied from `terraform.tfvars.example`, with
   `ssh_public_key` set. If the same key is already registered in the Scaleway project,
   delete it there first: a project cannot hold the same key twice.
5. Node on this machine (the destroy guard runs `node`) and `curl` (the deletion schedule).

## A test day

```bash
cd _infra/test-rig-mac
terraform init                               # once
terraform apply -var server_count=2          # morning: rent the Macs; delivery takes minutes
terraform output macs                        # addresses, logins, earliest deletion times

# Set up each Mac (about 15 minutes each; they can run side by side):
TEST_RIG_PASSWORD="$(terraform output -json passwords | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0]')" \
  ./setup.sh --to <username>@<ip>

ssh <username>@<ip> 'bash -s' < probe.sh     # the first day: the probe, below
# ... measure ...

terraform destroy                            # after earliest_delete, or let Scaleway delete them
```

### Set-up

`setup.sh --to` runs on this machine: it sends the Mac user's password and then the script over
one SSH connection, runs it on the Mac, and waits for the Mac to come back from its restart and
checks that automatic login worked. On the Mac it is idempotent step by step and logs to
`~/test-rig/setup.log`:

1. **Access first.** SSH by key only (`/etc/ssh/sshd_config.d/000-test-rig.conf`, checked with
   `sshd -t` before it can apply). The packet filter `pf` lets in SSH (and ICMP, DHCP and IPv6
   neighbour discovery, which the network needs) and nothing else, loaded at every boot by a
   launch daemon. Scaleway's image has SSH, Screen Sharing on a randomly chosen port watched
   by `fail2ban`, and `scw-agent`, which needs no inbound port. Screen Sharing stays closed
   unless `allow_vnc` is set (setup then keeps its port open).
2. **Software.** Chrome stable (not pinnable: Google serves only the current build; its
   signature and Google's team id are checked, and the version logged), Node 22.13.1 (the
   development machine's), Git LFS 3.8.0, both checked by SHA-256 into `~/test-rig`, and the
   `chrome-devtools` command-line tool from `chrome-devtools-mcp@1.8.0` (the development
   machine's; 1.10.1 is the newest). Git comes with the Xcode Scaleway preinstalls. Direct
   downloads rather than Homebrew, so nothing else is installed.
3. **A window session with nobody at the screen.** FileVault must be off for automatic login
   and for any remote access after a restart: set-up reports it and stops if it is on, and
   turns nothing off. Automatic login uses macOS's own mechanism (`autoLoginUser` and
   `/etc/kcpassword`). Display sleep, system sleep and the screen saver are turned off.
4. **The repository**, cloned with its LFS assets at `TEST_RIG_REF` (default `main`), then
   `npm ci`.

Then one restart. `run_setup_from_terraform` makes `apply` do all of this; it is off by default
until a first day has shown the script working on Scaleway's image, because run by hand its
output is in front of you, it can be stopped, and each Mac can be rerun on its own.

### The password

Scaleway creates each Mac's user with a random password, which the API returns and the
Terraform provider stores as `password`. It is needed for `sudo` and for automatic login, and
where it goes is:

- **Terraform state, in clear text**, in `gs://fps-csarko-tfstate/test-rig-mac/` and in the
  bucket's older versions of that object. The provider stores it twice: in `password` (marked
  sensitive, which only hides it from Terraform's screen output) and inside `vnc_url` (not
  marked sensitive, so `terraform show` prints it; the outputs here carry only the port). This
  cannot be avoided with this provider. The bucket is private, and a password stops meaning
  anything once its Mac is deleted at the end of the day.
- `terraform output -json passwords` → an environment variable of the local `setup.sh`
  process (not the shell history: the history holds the command, not its output) → the SSH
  connection's standard input → the remote shell's memory → `sudo` through an askpass helper
  that reads the environment. Never on a command line on either machine, never in a file in
  the clear.
- `/etc/kcpassword` on the Mac, which is how macOS itself stores an automatic-login password:
  readable only by root, and obfuscated, not encrypted. It is deleted with the Mac.

## The first day's probe

Two Macs for one day, **EUR 10.56**, settle the three unknowns before any result is believed.

1. **Does Chrome get the GPU?** `ssh <username>@<ip> 'bash -s' < probe.sh` reports macOS,
   whether the window session exists, the displays macOS reports (`system_profiler
   SPDisplaysDataType`), and then starts Chrome three ways: from the SSH shell headless, and
   inside the window session (through `launchctl asuser`, which runs a command in the logged-in
   user's GUI context from an SSH shell) headless and in a window. For each it prints the WebGL2
   unmasked renderer (the development machine reads `ANGLE (Apple, ANGLE Metal Renderer: Apple
   M4, Unspecified Version)`), the WebGPU adapter, the screen size Chrome sees and its frame
   interval. Headless Chrome always draws to an 800 × 600 screen at 60 frames a second, so
   only the windowed run tells what display the Mac has. Scaleway documents nothing about a
   display on its Macs; if macOS reports none, or the windowed run is capped at 60 or 30 Hz,
   ask Scaleway support whether an HDMI display emulator is fitted, and meanwhile measure with
   Chrome's `--disable-gpu-vsync --disable-frame-rate-limit` so the display does not set the
   frame time.
2. **How steady is it?** `ssh <username>@<ip> 'bash -s -- <url> 60' < probe.sh` also loads
   the page at `<url>` in a window and records 60 seconds of frame intervals, twice. Run it on
   both Macs. The spread between the two runs on one Mac, and between the two Macs, is the
   noise any later difference has to beat.
3. **What does an early destroy do?** Some hours into the day, on the second Mac only:
   `terraform state rm 'terraform_data.day_guard[1]'`, then
   `terraform destroy -target='scaleway_apple_silicon_server.mac[1]'`. An error means the API
   refuses, which is the good case. Success means either it was deleted early (the invoice then
   shows whether the full day was billed) or the provider swallowed a refusal (the Mac is still
   listed in the Scaleway console, billing, and unknown to Terraform; delete it in the console
   after its 24 hours).

## When a Mac is unreachable

`pf` is reloaded at every boot, so a restart from the Scaleway console does not undo a
firewall mistake. The way back is the console's **Reinstall**, which wipes the Mac to
Scaleway's stock macOS on the same server (the day's clock keeps running); then run
`setup.sh --to` again. Screen Sharing is closed by set-up, so the console's remote desktop
also needs `allow_vnc` (or a reinstall).
