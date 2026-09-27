#!/usr/bin/env bash
# Sets up a freshly delivered Scaleway Mac for frame-time measurements.
#
# Run from this machine, not on the Mac:
#
#   TEST_RIG_PASSWORD=... ./setup.sh --to <username>@<ip>
#
# which sends the password and then this script to the Mac over one SSH
# connection's standard input (the password is never on a command line, on
# either machine), runs it there, and waits for the Mac to come back from the
# restart that turns automatic login on. README.md shows how to take the
# password from `terraform output` without typing it.
#
# On the Mac it is idempotent step by step (each step checks before it acts)
# and logs to ~/test-rig/setup.log. Its steps, in order:
#   1. access: SSH by key only; pf lets in SSH and nothing else (Screen Sharing
#      too if TEST_RIG_VNC_PORT is set);
#   2. software: Chrome (stable), Node, Git LFS, the chrome-devtools CLI;
#   3. a logged-in window session with nobody at a screen: automatic login,
#      no display sleep, no screen saver;
#   4. the repository with its LFS assets, and `npm ci`;
#   then one restart, so automatic login takes effect.
#
# Environment (all optional except the password):
#   TEST_RIG_PASSWORD  the Mac user's password (sudo, automatic login)
#   TEST_RIG_VNC_PORT  keep Screen Sharing reachable on this port
#   TEST_RIG_REF       git ref to check out (default: main)

set -euo pipefail

NODE_VERSION=22.13.1 # the development machine's
NODE_SHA256=97483ff4361d239a56d038c6335767a56a291e78c10f07446f463f05d9d19b89
GIT_LFS_VERSION=3.8.0
GIT_LFS_SHA256=caff76a7d070d8160c89bc39b6e85d98f24135b6fed038a3b4de2590d25102d8
DEVTOOLS_CLI_VERSION=1.8.0 # chrome-devtools-mcp, the development machine's
REPO_URL=https://github.com/csarkosh/game-dayhike.git

# --- This machine: send the script, then wait out the restart -----------------
if [[ "${1:-}" == --to ]]; then
  target=${2:?usage: setup.sh --to <username>@<ip>}
  : "${TEST_RIG_PASSWORD:?set TEST_RIG_PASSWORD to the password of the Mac user}"
  ssh_opts=(-o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 -o ConnectTimeout=10)
  # First line of stdin: the password, kept in the remote shell's memory. The
  # rest: this script, saved and then run with stdin closed, so nothing it
  # runs can swallow its own remaining lines.
  # The two options below expand here, on purpose.
  # shellcheck disable=SC2029
  {
    printf '%s\n' "$TEST_RIG_PASSWORD"
    cat "$0"
  } | ssh "${ssh_opts[@]}" "$target" \
    "IFS= read -r TEST_RIG_PASSWORD && export TEST_RIG_PASSWORD \
     TEST_RIG_VNC_PORT='${TEST_RIG_VNC_PORT:-}' TEST_RIG_REF='${TEST_RIG_REF:-main}' \
     && mkdir -p ~/test-rig && cat >~/test-rig/setup.sh && bash ~/test-rig/setup.sh </dev/null" ||
    true # the restart at the end cuts the connection

  echo "Waiting for $target to come back from its restart..."
  sleep 30
  for _ in $(seq 1 60); do
    if console_user=$(ssh "${ssh_opts[@]}" -o BatchMode=yes "$target" 'stat -f %Su /dev/console' 2>/dev/null); then
      echo "SSH is back. Console user: $console_user"
      if [[ "$console_user" == "${target%@*}" ]]; then
        echo "Automatic login worked: a window session exists."
        exit 0
      fi
      echo "Automatic login did NOT take effect (console user is '$console_user'). See README.md, 'Set-up'."
      exit 1
    fi
    sleep 10
  done
  echo "SSH did not come back within about 15 minutes. See README.md, 'When a Mac is unreachable'."
  exit 1
fi

# --- The Mac --------------------------------------------------------------------
: "${TEST_RIG_PASSWORD:?run this through setup.sh --to, which supplies the password}"
RIG=$HOME/test-rig
mkdir -p "$RIG/bin" "$RIG/downloads"
exec > >(tee -a "$RIG/setup.log") 2>&1
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
log "Set-up starting on $(hostname) as $USER, macOS $(sw_vers -productVersion)"

# sudo reads the password from the environment through an askpass helper, so
# it is never written to disk or passed as an argument.
cat >"$RIG/askpass" <<'EOF'
#!/bin/sh
printf '%s\n' "$TEST_RIG_PASSWORD"
EOF
chmod 700 "$RIG/askpass"
export SUDO_ASKPASS=$RIG/askpass
as_root() { sudo -A "$@"; }
as_root -v

fetch() { # url, file, sha256
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

# --- 1. Access ------------------------------------------------------------------
# What Scaleway's image has open, per its documentation: SSH (22), Screen
# Sharing on a randomly chosen port, fail2ban watching Screen Sharing, and
# scw-agent, which keeps the project's SSH keys installed and needs no inbound
# port. SSH keeps working throughout; Scaleway's console "Reinstall" is the way
# back if it does not (README.md).
sshd_conf=/etc/ssh/sshd_config.d/000-test-rig.conf
if [[ ! -f "$sshd_conf" ]]; then
  log 'SSH: key only'
  # 000- so it is read before macOS's own 100-macos.conf: sshd keeps the first
  # value it reads for each setting.
  printf '%s\n' 'PasswordAuthentication no' 'KbdInteractiveAuthentication no' 'PermitRootLogin no' |
    as_root tee "$sshd_conf" >/dev/null
  as_root /usr/sbin/sshd -t # a broken config would lock the next login out
fi

pf_rules=/etc/pf.anchors/test-rig
{
  echo 'set skip on lo0'
  echo 'block in all'
  echo 'pass out all keep state'
  echo 'pass in quick inet proto tcp to any port 22 keep state'
  [[ -n "${TEST_RIG_VNC_PORT:-}" ]] && echo "pass in quick inet proto tcp to any port ${TEST_RIG_VNC_PORT} keep state"
  echo 'pass in quick inet proto udp from any port 67 to any port 68' # DHCP
  echo 'pass in quick inet proto icmp all'
  echo 'pass quick inet6 proto icmp6 all' # IPv6 neighbour discovery
} >"$RIG/pf.rules"
if ! as_root cmp -s "$RIG/pf.rules" "$pf_rules" 2>/dev/null; then
  log "pf: inbound SSH only${TEST_RIG_VNC_PORT:+, and Screen Sharing on $TEST_RIG_VNC_PORT}"
  as_root pfctl -n -f "$RIG/pf.rules" # syntax check before loading
  as_root cp "$RIG/pf.rules" "$pf_rules"
fi
pf_daemon=/Library/LaunchDaemons/sh.test-rig.pf.plist
if [[ ! -f "$pf_daemon" ]]; then
  log 'pf: load at every boot'
  as_root tee "$pf_daemon" >/dev/null <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>sh.test-rig.pf</string>
  <key>ProgramArguments</key><array>
    <string>/bin/sh</string><string>-c</string>
    <string>/sbin/pfctl -f $pf_rules; /sbin/pfctl -e || true</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict></plist>
EOF
fi
as_root pfctl -f "$pf_rules" 2>/dev/null
as_root pfctl -e 2>/dev/null || true # "already enabled" is fine

# --- 2. Software ----------------------------------------------------------------
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
if [[ "$(npm ls -g --prefix "$RIG/npm" --depth=0 2>/dev/null | grep -c "chrome-devtools-mcp@$DEVTOOLS_CLI_VERSION")" == 0 ]]; then
  npm install -g --prefix "$RIG/npm" "chrome-devtools-mcp@$DEVTOOLS_CLI_VERSION"
fi
log "Node $(node --version), npm $(npm --version), $(git --version), $(git lfs version), chrome-devtools $(chrome-devtools --version 2>/dev/null || echo "$DEVTOOLS_CLI_VERSION")"

# --- 3. A window session with nobody at the screen ------------------------------
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
# a multiple of 12 bytes. Written byte by byte from memory, so the password is
# never on a command line or in a file in the clear.
if [[ "$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || true)" != "$USER" ]] ||
  ! as_root test -f /etc/kcpassword; then
  log "Automatic login for $USER"
  key=(125 137 82 35 210 188 221 234 163 185 31)
  bytes=()
  pw=$TEST_RIG_PASSWORD
  for ((i = 0; i < ${#pw}; i++)); do
    bytes+=("$(printf '%d' "'${pw:i:1}")")
  done
  bytes+=(0)
  while ((${#bytes[@]} % 12)); do bytes+=(0); done
  out=''
  for ((i = 0; i < ${#bytes[@]}; i++)); do
    out+=$(printf '\\x%02x' $((bytes[i] ^ key[i % 11])))
  done
  # shellcheck disable=SC2059 # the format IS the escaped bytes
  printf "$out" | as_root tee /etc/kcpassword >/dev/null
  as_root chmod 600 /etc/kcpassword
  as_root defaults write /Library/Preferences/com.apple.loginwindow autoLoginUser "$USER"
fi

# Nothing may dim, sleep or lock the display a measurement draws to.
as_root pmset -a displaysleep 0 sleep 0 disksleep 0
defaults -currentHost write com.apple.screensaver idleTime -int 0
log "Power: $(pmset -g | grep -E ' (sleep|displaysleep) ' | tr -s ' ' | tr '\n' ';')"

# --- 4. The repository ----------------------------------------------------------
repo=$HOME/game-dayhike
if [[ ! -d "$repo/.git" ]]; then
  git clone "$REPO_URL" "$repo"
fi
git -C "$repo" fetch --quiet origin
git -C "$repo" checkout --quiet "${TEST_RIG_REF:-main}"
git -C "$repo" pull --quiet --ff-only 2>/dev/null || true # a detached ref has nothing to pull
git -C "$repo" lfs pull
(cd "$repo" && npm ci --no-audit --no-fund)
log "Repository at $(git -C "$repo" rev-parse --short HEAD), assets $(du -sh "$repo/client/assets" | cut -f1)"

# --- Restart --------------------------------------------------------------------
if [[ "$(stat -f %Su /dev/console)" == "$USER" ]]; then
  log "Set-up finished; $USER is already logged in at the console, no restart needed."
  exit 0
fi
log 'Set-up finished. Restarting so automatic login takes effect.'
as_root shutdown -r +0
