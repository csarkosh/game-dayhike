#!/usr/bin/env bash
# Sets up a freshly delivered Scaleway Mac for frame-time measurements.
#
# Run from this machine, not on the Mac, straight after `terraform apply`:
#
#   TEST_RIG_PASSWORD=... TEST_RIG_VNC_PORT=... ./setup.sh --to <username>@<ip>
#
# README.md shows how to fill both from `terraform output` without typing the
# password. This side:
#   - proves that key login works, on its own connection with BatchMode, before
#     anything on the Mac changes (set-up turns password login off);
#   - sends the password and then this script over one SSH connection's
#     standard input (never on a command line, on either machine) and runs it;
#   - waits for the Mac to come back from its restart and checks, from outside,
#     that automatic login worked, that only SSH answers, that pf is enabled
#     with this script's rules, and that a password login is refused. Any
#     mismatch fails loudly.
#
# On the Mac it is idempotent step by step (each step checks before it acts)
# and logs to ~/test-rig/setup.log:
#   1. access: SSH by key only; pf lets in SSH and nothing else (Screen Sharing
#      too if TEST_RIG_ALLOW_VNC=1);
#   2. software: Chrome (stable), Node, Git LFS, the chrome-devtools CLI;
#   3. a logged-in desktop with nobody at a screen: automatic login, no
#      display sleep, no screen saver;
#   4. the repository with its LFS assets, and `npm ci`;
#   then one restart, so automatic login takes effect.
#
# Environment:
#   TEST_RIG_PASSWORD   the Mac user's password (sudo, automatic login)
#   TEST_RIG_VNC_PORT   the Mac's Screen Sharing port (checked closed, or open)
#   TEST_RIG_ALLOW_VNC  1 keeps Screen Sharing reachable; default 0
#   TEST_RIG_REF        git ref to check out; default main
#
# Written for the bash 3.2 macOS ships, on both machines.

set -euo pipefail

NODE_VERSION=22.13.1 # the development machine's
NODE_SHA256=97483ff4361d239a56d038c6335767a56a291e78c10f07446f463f05d9d19b89
GIT_LFS_VERSION=3.8.0
GIT_LFS_SHA256=caff76a7d070d8160c89bc39b6e85d98f24135b6fed038a3b4de2590d25102d8
DEVTOOLS_CLI_VERSION=1.8.0 # chrome-devtools-mcp, the development machine's
REPO_URL=https://github.com/csarkosh/game-dayhike.git
DONE_RESTARTING='test-rig: set-up finished, restarting'
DONE_NO_RESTART='test-rig: set-up finished, no restart needed'

# --- This machine ----------------------------------------------------------------
if [[ "${1:-}" == --to ]]; then
  target=${2:?usage: setup.sh --to <username>@<ip>}
  user=${target%@*}
  ip=${target#*@}
  allow_vnc=${TEST_RIG_ALLOW_VNC:-0}
  : "${TEST_RIG_PASSWORD:?set TEST_RIG_PASSWORD to the password of the Mac user}"
  : "${TEST_RIG_VNC_PORT:?set TEST_RIG_VNC_PORT to the Screen Sharing port of the Mac, from terraform output macs}"
  ssh_opts=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 -o ConnectTimeout=10)
  fail() {
    echo "FAILED: $*" >&2
    exit 1
  }

  echo "Checking that $target accepts the SSH key, before anything changes..."
  if ! ssh "${ssh_opts[@]}" "$target" true; then
    fail "key login to $target did not work, so set-up would lock the Mac out. If ssh reported a changed host key, the address was used by an earlier Mac: run ssh-keygen -R $ip and retry."
  fi

  # First line of stdin: the password, kept in memory. The rest: this script,
  # saved and run with stdin closed, so nothing it runs can swallow its lines.
  out=$(mktemp -t test-rig-setup)
  # The three options below expand here, on purpose.
  # shellcheck disable=SC2029
  {
    printf '%s\n' "$TEST_RIG_PASSWORD"
    cat "$0"
  } | ssh "${ssh_opts[@]}" "$target" \
    "IFS= read -r TEST_RIG_PASSWORD && export TEST_RIG_PASSWORD \
     TEST_RIG_ALLOW_VNC='$allow_vnc' TEST_RIG_VNC_PORT='$TEST_RIG_VNC_PORT' TEST_RIG_REF='${TEST_RIG_REF:-main}' \
     && mkdir -p ~/test-rig && cat >~/test-rig/setup.sh && bash ~/test-rig/setup.sh </dev/null" |
    tee "$out" || true # the restart cuts the connection; the last line says how it ended
  if grep -qF "$DONE_RESTARTING" "$out"; then
    echo "Waiting for $target to come back from its restart..."
    sleep 30
    back=0
    for _ in $(seq 1 60); do
      if ssh "${ssh_opts[@]}" "$target" true 2>/dev/null; then
        back=1
        break
      fi
      sleep 10
    done
    ((back)) || fail "SSH did not come back within about 15 minutes. See README.md, 'When a Mac is unreachable'."
  elif ! grep -qF "$DONE_NO_RESTART" "$out"; then
    fail "set-up stopped on the Mac before it finished; the lines above say where. ~/test-rig/setup.log on the Mac has them too."
  fi
  rm -f "$out"

  echo "Checking the Mac from outside..."
  console=$(ssh "${ssh_opts[@]}" "$target" 'stat -f %Su /dev/console')
  [[ "$console" == "$user" ]] || fail "automatic login did not take effect (console user is '$console'). See README.md, 'Set-up'."
  echo "  logged-in desktop: yes ($console)"

  nc -z -G 5 "$ip" 22 || fail "port 22 does not answer from outside"
  echo "  port 22: open"
  for port in "$TEST_RIG_VNC_PORT" 5900 3283; do
    if [[ "$port" == "$TEST_RIG_VNC_PORT" && "$allow_vnc" == 1 ]]; then
      nc -z -G 5 "$ip" "$port" || fail "Screen Sharing ($port) should be reachable (TEST_RIG_ALLOW_VNC=1) and is not"
      echo "  port $port (Screen Sharing): open, as asked"
    else
      if nc -z -G 5 "$ip" "$port" 2>/dev/null; then
        fail "port $port answers from outside; pf is not holding"
      fi
      echo "  port $port: closed"
    fi
  done

  # sudo -S reads the password from stdin: never on a command line.
  pf=$(printf '%s\n' "$TEST_RIG_PASSWORD" | ssh "${ssh_opts[@]}" "$target" \
    'IFS= read -r p; printf "%s\n" "$p" | sudo -S -p "" sh -c "/sbin/pfctl -s info; /sbin/pfctl -a test-rig -s rules" 2>/dev/null')
  grep -q 'Status: Enabled' <<<"$pf" || fail "pf is not enabled after the restart"
  grep -q 'port = 22' <<<"$pf" || fail "pf is enabled but the test-rig rules are not loaded"
  echo "  pf: enabled, test-rig rules loaded"

  methods=$(ssh -v -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o PubkeyAuthentication=no \
    -o PreferredAuthentications=password,keyboard-interactive "$target" true 2>&1 |
    grep -m1 'Authentications that can continue' || true)
  [[ -n "$methods" ]] || fail "could not read which login methods sshd offers"
  if grep -qE 'password|keyboard-interactive' <<<"$methods"; then
    fail "sshd still offers password login: $methods"
  fi
  echo "  password login: refused (${methods##*: })"
  echo "Set-up of $target verified."
  exit 0
fi

# --- The Mac ---------------------------------------------------------------------
: "${TEST_RIG_PASSWORD:?run this through setup.sh --to, which supplies the password}"
# Kept in a shell variable, out of the environment of everything set-up runs
# (npm install scripts included); only sudo's askpass helper is handed it.
pw=$TEST_RIG_PASSWORD
unset TEST_RIG_PASSWORD
RIG=$HOME/test-rig
mkdir -p "$RIG/bin" "$RIG/downloads"
exec > >(tee -a "$RIG/setup.log") 2>&1
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
log "Set-up starting on $(hostname) as $USER, macOS $(sw_vers -productVersion)"

# The automatic-login encoding below handles one byte per character.
LC_ALL=C
for ((i = 0; i < ${#pw}; i++)); do
  code=$(printf '%d' "'${pw:i:1}")
  if ((code < 32 || code > 126)); then
    log 'The password has a character outside printable ASCII; this script cannot encode it for automatic login. Stopping before any change.'
    exit 1
  fi
done

cat >"$RIG/askpass" <<'EOF'
#!/bin/sh
printf '%s\n' "$TEST_RIG_PASSWORD"
EOF
chmod 700 "$RIG/askpass"
as_root() { TEST_RIG_PASSWORD=$pw SUDO_ASKPASS=$RIG/askpass sudo -A "$@"; }
as_root -v

fetch() { # url, file, sha256; prints the path
  local file=$RIG/downloads/$2
  if [[ ! -f "$file" ]] || [[ "$(shasum -a 256 "$file" | cut -d' ' -f1)" != "$3" ]]; then
    log "Downloading $1"
    curl -fsSL "$1" -o "$file"
  fi
  if [[ "$(shasum -a 256 "$file" | cut -d' ' -f1)" != "$3" ]]; then
    rm -f "$file"
    log "SHA-256 mismatch for $2"
    exit 1
  fi
  printf '%s' "$file"
}

# --- 1. Access -------------------------------------------------------------------
# What Scaleway's image has open, per its documentation: SSH (22), Screen
# Sharing on a randomly chosen port, fail2ban watching Screen Sharing, and
# scw-agent, which keeps the project's SSH keys installed and needs no inbound
# port. Key login was proven on a separate connection before this ran.
sshd_conf=/etc/ssh/sshd_config.d/000-test-rig.conf
printf '%s\n' 'PasswordAuthentication no' 'KbdInteractiveAuthentication no' 'PermitRootLogin no' >"$RIG/sshd.conf"
if ! as_root cmp -s "$RIG/sshd.conf" "$sshd_conf" 2>/dev/null; then
  log 'SSH: key only'
  had_previous=0
  if as_root test -f "$sshd_conf"; then
    as_root cp -p "$sshd_conf" "$RIG/sshd.conf.previous"
    had_previous=1
  fi
  # 000- so it is read before macOS's own 100-macos.conf: sshd keeps the first
  # value it reads for each setting.
  as_root install -m 644 "$RIG/sshd.conf" "$sshd_conf"
  if ! as_root /usr/sbin/sshd -t; then
    if ((had_previous)); then as_root cp -p "$RIG/sshd.conf.previous" "$sshd_conf"; else as_root rm -f "$sshd_conf"; fi
    log 'sshd rejected the new configuration; the previous one is back. Stopping.'
    exit 1
  fi
fi
as_root /usr/sbin/sshd -T 2>/dev/null | grep -qx 'passwordauthentication no' || {
  log 'sshd does not report password authentication off. Stopping.'
  exit 1
}

# The rules live in their own anchor, referenced from /etc/pf.conf, so that
# Apple's loader (`pfctl -f /etc/pf.conf` at boot) and this one load the same
# thing in whichever order they run. SSH is passed without state: a rule that
# keeps state only creates it on a connection's first packet, so the
# connection running this script, opened before pf was on, would be dropped.
pf_anchor=/etc/pf.anchors/test-rig
{
  echo 'block in all'
  echo 'pass in quick on lo0 all'
  echo 'pass in quick proto tcp from any to any port 22 no state'
  if [[ "${TEST_RIG_ALLOW_VNC:-0}" == 1 && -n "${TEST_RIG_VNC_PORT:-}" ]]; then
    echo "pass in quick proto tcp from any to any port ${TEST_RIG_VNC_PORT} keep state"
  fi
  echo 'pass in quick inet proto udp from any port 67 to any port 68' # DHCP
  echo 'pass in quick inet proto icmp all'
  echo 'pass in quick inet6 proto icmp6 all' # IPv6 neighbour discovery
  echo 'pass out all keep state'
} >"$RIG/pf.anchor"
if ! as_root cmp -s "$RIG/pf.anchor" "$pf_anchor" 2>/dev/null; then
  vnc_state=closed
  [[ "${TEST_RIG_ALLOW_VNC:-0}" == 1 ]] && vnc_state=open
  log "pf: inbound SSH only; Screen Sharing ${TEST_RIG_VNC_PORT:-(port unknown)} $vnc_state"
  as_root install -m 644 "$RIG/pf.anchor" "$pf_anchor"
fi
if ! grep -qF 'anchor "test-rig"' /etc/pf.conf; then
  log 'pf: referencing the anchor from /etc/pf.conf'
  as_root cp -p /etc/pf.conf "$RIG/pf.conf.previous"
  {
    cat /etc/pf.conf
    echo 'anchor "test-rig"'
    echo 'load anchor "test-rig" from "/etc/pf.anchors/test-rig"'
  } >"$RIG/pf.conf"
  as_root pfctl -n -f "$RIG/pf.conf" # syntax check first
  as_root install -m 644 "$RIG/pf.conf" /etc/pf.conf
fi
as_root pfctl -n -f /etc/pf.conf
pf_daemon=/Library/LaunchDaemons/sh.test-rig.pf.plist
if [[ ! -f "$pf_daemon" ]]; then
  log 'pf: enable at every boot'
  # -E is the reference-counted enable that /etc/pf.conf asks components to use.
  as_root tee "$pf_daemon" >/dev/null <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>sh.test-rig.pf</string>
  <key>ProgramArguments</key><array>
    <string>/sbin/pfctl</string><string>-E</string><string>-f</string><string>/etc/pf.conf</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict></plist>
EOF
fi
as_root pfctl -E -f /etc/pf.conf
as_root pfctl -s info | grep -q 'Status: Enabled' || {
  log 'pf did not enable. Stopping.'
  exit 1
}

# --- 2. Software -----------------------------------------------------------------
# Direct downloads into ~/test-rig rather than Homebrew: nothing else is
# installed, and the Mac is deleted at the end of the day anyway.
if [[ ! -d "/Applications/Google Chrome.app" ]]; then
  # Not pinnable: Google serves only the current stable build. Its signature
  # is checked instead, and the version logged.
  dmg=$RIG/downloads/googlechrome.dmg
  log 'Chrome: downloading the current stable build'
  curl -fsSL https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg -o "$dmg"
  mount=$(hdiutil attach -nobrowse -readonly "$dmg" | awk -F'\t' '/\/Volumes\//{print $NF}')
  as_root cp -R "$mount/Google Chrome.app" /Applications/
  hdiutil detach -quiet "$mount"
fi
codesign --verify --deep --strict "/Applications/Google Chrome.app"
codesign -dv "/Applications/Google Chrome.app" 2>&1 | grep -q 'TeamIdentifier=EQHXZ8M8AV' # Google LLC
log "Chrome: $(defaults read "/Applications/Google Chrome.app/Contents/Info" CFBundleShortVersionString)"

node_dir=$RIG/node-v$NODE_VERSION-darwin-arm64
if [[ ! -x "$node_dir/bin/node" ]]; then
  tarball=$(fetch "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-arm64.tar.gz" \
    "node-v$NODE_VERSION-darwin-arm64.tar.gz" "$NODE_SHA256")
  tar -xzf "$tarball" -C "$RIG"
fi

if [[ ! -x "$RIG/bin/git-lfs" ]]; then
  zip=$(fetch "https://github.com/git-lfs/git-lfs/releases/download/v$GIT_LFS_VERSION/git-lfs-darwin-arm64-v$GIT_LFS_VERSION.zip" \
    "git-lfs-v$GIT_LFS_VERSION.zip" "$GIT_LFS_SHA256")
  unzip -qo "$zip" -d "$RIG/downloads/git-lfs"
  cp "$RIG/downloads/git-lfs/git-lfs-$GIT_LFS_VERSION/git-lfs" "$RIG/bin/"
fi

# Every later SSH command (zsh reads ~/.zshenv even when not interactive) finds
# these first.
path_line="export PATH=\"$RIG/bin:$node_dir/bin:$RIG/npm/bin:\$PATH\""
grep -qxF "$path_line" "$HOME/.zshenv" 2>/dev/null || echo "$path_line" >>"$HOME/.zshenv"
export PATH="$RIG/bin:$node_dir/bin:$RIG/npm/bin:$PATH"

# Git comes with the Xcode that Scaleway preinstalls.
git lfs install >/dev/null
if [[ ! -x "$RIG/npm/bin/chrome-devtools" ]] ||
  ! npm ls -g --prefix "$RIG/npm" --depth=0 2>/dev/null | grep -qF "chrome-devtools-mcp@$DEVTOOLS_CLI_VERSION"; then
  npm install -g --prefix "$RIG/npm" "chrome-devtools-mcp@$DEVTOOLS_CLI_VERSION"
fi
log "Node $(node --version), npm $(npm --version), $(git --version), $(git lfs version), chrome-devtools-mcp $DEVTOOLS_CLI_VERSION"

# --- 3. A logged-in desktop with nobody at the screen ------------------------------
# FileVault blocks automatic login and all remote access after a restart.
# Reported, never changed: if it is on, set-up stops here.
filevault=$(fdesetup status)
log "FileVault: $filevault"
if [[ "$filevault" != *"is Off"* ]]; then
  log 'FileVault is not off: automatic login cannot work. Stopping before the restart.'
  exit 1
fi

# macOS's own mechanism: loginwindow's autoLoginUser plus /etc/kcpassword,
# the password XOR-ed with Apple's fixed 11-byte key and padded with zeros to
# a multiple of 12 bytes. Built in memory and written to a file created 0600,
# so the password is never on a command line or readable by anyone but root.
if [[ "$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || true)" != "$USER" ]] ||
  ! as_root test -f /etc/kcpassword; then
  log "Automatic login for $USER"
  key=(125 137 82 35 210 188 221 234 163 185 31)
  bytes=()
  for ((i = 0; i < ${#pw}; i++)); do
    bytes+=("$(printf '%d' "'${pw:i:1}")")
  done
  bytes+=(0)
  while ((${#bytes[@]} % 12)); do bytes+=(0); done
  out=''
  for ((i = 0; i < ${#bytes[@]}; i++)); do
    out+=$(printf '\\x%02x' $((bytes[i] ^ key[i % 11])))
  done
  as_root install -m 600 /dev/null /etc/kcpassword
  # shellcheck disable=SC2059 # the format IS the escaped bytes
  printf "$out" | as_root tee /etc/kcpassword >/dev/null
  as_root defaults write /Library/Preferences/com.apple.loginwindow autoLoginUser "$USER"
fi

# Nothing may dim or sleep the display a measurement draws to. The screen lock
# is left as it is: it only follows the screen saver or display sleep, and
# both are off. Turning it off would need the password on a command line
# (`sysadminctl -screenLock off -password`).
as_root pmset -a displaysleep 0 sleep 0 disksleep 0
defaults -currentHost write com.apple.screensaver idleTime -int 0
log "Power: $(pmset -g | grep -E ' (sleep|displaysleep) ' | tr -s ' ' | tr '\n' ';')"

# --- 4. The repository -------------------------------------------------------------
repo=$HOME/game-dayhike
if [[ ! -d "$repo/.git" ]]; then
  git clone "$REPO_URL" "$repo"
fi
git -C "$repo" fetch --quiet origin
git -C "$repo" checkout --quiet "${TEST_RIG_REF:-main}"
if git -C "$repo" symbolic-ref -q HEAD >/dev/null; then # a branch, not a fixed commit
  git -C "$repo" pull --quiet --ff-only
fi
git -C "$repo" lfs pull
(cd "$repo" && npm ci --no-audit --no-fund)
log "Repository at $(git -C "$repo" rev-parse --short HEAD), assets $(du -sh "$repo/client/assets" | cut -f1)"

# --- Restart ---------------------------------------------------------------------
if [[ "$(stat -f %Su /dev/console)" == "$USER" ]]; then
  echo "$DONE_NO_RESTART ($USER is already logged in at the console)"
  exit 0
fi
echo "$DONE_RESTARTING so that automatic login takes effect"
sleep 5 # let that line reach the other end before the connection drops
as_root shutdown -r +0
