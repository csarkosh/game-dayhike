#!/usr/bin/env bash
# A graphics work session's rigs, made first and ended last, so that the slow steps run while the
# work goes on and nothing bills between sessions. A rig is a rented Windows GPU machine
# (`_infra/test-rig-aws-windows/`), made from its image in about 8 minutes, and ended, disk and
# all, when the session is done or fifteen minutes after the last harness left it (its idle
# watchdog); only the image survives.
#
#   tools/rig/session.sh up [N] [--channel <name>] [--no-maps]   N rigs (1 by default) from the image,
#                                                                 the WGSL maps built meanwhile, and a
#                                                                 preview channel published if named;
#                                                                 a forward a rig on 9333, 9334, ...
#   tools/rig/session.sh status                                   each rig's state and whether its Chrome answers
#   tools/rig/session.sh down                                     ends every rig and its forward
#
# Run from any checkout: the rigs are applied from the main checkout's root, as `round.sh` does.
# Logs go on the lab disk (`DAYHIKE_LAB`, `/Volumes/CyrusExtSSD/dayhike-lab` by default), under
# `rig-sessions/<date>/`, never this Mac's own disk; `up` refuses to start without it. Making
# machines costs money ($0.715 an hour each), so `up` is run with the owner's go-ahead, as any
# `terraform apply` on the rigs is. Written for the bash 3.2 macOS ships.
set -euo pipefail

here="$(cd "$(dirname "$0")/../.." && pwd)"
main="$(dirname "$(git -C "$here" rev-parse --path-format=absolute --git-common-dir)")"
root="$main/_infra/test-rig-aws-windows"
region=us-east-1
lab="${DAYHIKE_LAB:-/Volumes/CyrusExtSSD/dayhike-lab}"
first_port=9333

say() { echo "$(date '+%H:%M:%S') $*"; }
need_root() { [ -d "$root/.terraform" ] || { echo "the rig root is not initialised: run terraform init in $root" >&2; exit 2; }; }
need_lab() { [ -d "$lab" ] || { echo "the lab disk is not mounted ($lab): mount it, or set DAYHIKE_LAB" >&2; exit 2; }; }
session_dir() { echo "$lab/rig-sessions/$(date '+%Y-%m-%d')"; }

# The machines the root's state names, one id a line.
state_ids() {
  (cd "$root" && terraform output -json instance_ids 2>/dev/null) |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{for(const id of JSON.parse(s))console.log(id)}catch{}})'
}
# Those still existing, with their state: "<id> <state>" a line, terminated ones left out.
live() {
  local ids
  ids=$(state_ids | tr '\n' ' ')
  [ -n "$ids" ] || return 0
  # shellcheck disable=SC2086,SC2016
  aws ec2 describe-instances --region "$region" --instance-ids $ids \
    --query 'Reservations[].Instances[?State.Name!=`terminated`].[InstanceId,State.Name]' --output text 2>/dev/null |
    awk 'NF == 2'
}
# Chrome's version behind a forwarded port, or nothing; never a failure (a port with nothing on
# it is the usual case while a rig boots, and `set -e` must not end the script on it).
chrome_version() {
  { curl -s --max-time 3 "http://127.0.0.1:$1/json/version" || true; } |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).Browser)}catch{}})' || true
}

up() {
  local count=1 channel="" maps=1 dir started apply_pid
  while [ $# -gt 0 ]; do
    case "$1" in
      --channel) channel="$2"; shift 2 ;;
      --no-maps) maps=0; shift ;;
      -*) echo "unknown option $1" >&2; exit 2 ;;
      *) count="$1"; shift ;;
    esac
  done
  case "$count" in '' | *[!0-9]* | 0) echo "up: the rig count is a whole number from 1, not '$count'" >&2; exit 2 ;; esac
  need_root; need_lab
  dir=$(session_dir); mkdir -p "$dir"
  started=$(date +%s)
  say "making $count rig(s) from the image (about 8 minutes to Chrome); the apply's log is $dir/apply.log"
  (cd "$root" && terraform apply -input=false -auto-approve -var running=true -var rig_count="$count") > "$dir/apply.log" 2>&1 &
  apply_pid=$!

  # Meanwhile, what the work needs on this side: the maps (nothing when the corpus is unchanged,
  # about a minute when it is not) and, if asked, a channel to measure or record from.
  if [ "$maps" = 1 ]; then
    say "building the WGSL maps (log: $dir/build-map.log)"
    if (cd "$here" && node tools/wgsl/build-map.mjs --reuse) > "$dir/build-map.log" 2>&1; then
      grep -E "up to date|ceiling:" "$dir/build-map.log" | sed 's/^/  /'
    else
      say "the maps did not build: see $dir/build-map.log"; tail -5 "$dir/build-map.log" | sed 's/^/  /'
    fi
  fi
  if [ -n "$channel" ]; then
    say "publishing the preview channel $channel (log: $dir/channel.log)"
    if (cd "$here" && npm run preview:channel -- "$channel") > "$dir/channel.log" 2>&1; then
      say "channel: $(tail -1 "$dir/channel.log")"
    else
      say "the channel did not publish: see $dir/channel.log"
    fi
  fi

  wait "$apply_pid" || { say "the apply failed: see $dir/apply.log"; tail -5 "$dir/apply.log" | sed 's/^/  /'; exit 1; }
  grep -E "Apply complete" "$dir/apply.log" | sed 's/^/  /'
  say "machines applied after $(( $(date +%s) - started )) s; waiting for each Chrome"

  local i=0 id port
  while read -r id; do
    [ "$i" -lt "$count" ] || break
    port=$(( first_port + i ))
    # Session Manager first (a forward opened before the agent is online hangs), then the forward,
    # which reopens itself for the session's life and holds the idle watchdog off while it runs.
    local t=0
    while [ "$(aws ssm describe-instance-information --region "$region" --filters "Key=InstanceIds,Values=$id" --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null)" != "Online" ]; do
      [ "$t" -lt 900 ] || { say "rig $i ($id): Session Manager not online after 15 minutes; see the console"; break; }
      sleep 10; t=$(( t + 10 ))
    done
    nohup "$here/tools/frame-budget/rig/forward.sh" "$id" "$port" > "$dir/forward-$port.log" 2>&1 &
    echo $! > "$dir/forward-$port.pid"
    disown 2>/dev/null || true
    t=0
    while [ -z "$(chrome_version "$port")" ]; do
      [ "$t" -lt 900 ] || { say "rig $i ($id): no Chrome on $port after 15 minutes; see $dir/forward-$port.log"; break; }
      sleep 5; t=$(( t + 5 ))
    done
    say "rig $i: $id on 127.0.0.1:$port, $(chrome_version "$port"), $(( $(date +%s) - started )) s after the start"
    i=$(( i + 1 ))
  done < <(state_ids)
  say "up: $i rig(s); end them with 'tools/rig/session.sh down', or they end themselves 15 minutes after the last harness and forward leave"
}

status() {
  need_root
  local rows
  rows=$(live)
  if [ -z "$rows" ]; then echo "no rig exists (the image is kept; 'session.sh up' makes one)"; return; fi
  local i=0 id state port chrome
  while read -r id state; do
    port=$(( first_port + i ))
    chrome=$(chrome_version "$port")
    echo "rig $i: $id $state; 127.0.0.1:$port: ${chrome:-no Chrome answering}"
    i=$(( i + 1 ))
  done <<< "$rows"
}

down() {
  need_root
  local dir pidfile pid ids
  dir=$(session_dir)
  for pidfile in "$dir"/forward-*.pid; do
    [ -f "$pidfile" ] || continue
    pid=$(cat "$pidfile")
    kill "$pid" 2>/dev/null && say "forward $(basename "$pidfile" .pid | sed 's/forward-//') ended" || true
    pkill -P "$pid" 2>/dev/null || true
    rm -f "$pidfile"
  done
  ids=$(live | awk '{print $1}' | tr '\n' ' ')
  if [ -z "$ids" ]; then say "no rig exists"; return; fi
  say "ending $ids"
  # shellcheck disable=SC2086
  aws ec2 terminate-instances --region "$region" --instance-ids $ids --query 'TerminatingInstances[].[InstanceId,CurrentState.Name]' --output text | sed 's/^/  /'
  say "down: the next 'session.sh up' makes new machines from the image; the state's rig_count stays as it was"
}

case "${1:-}" in
  up) shift; up "$@" ;;
  status) status ;;
  down) down ;;
  *) echo "usage: $0 up [N] [--channel <name>] [--no-maps] | status | down" >&2; exit 2 ;;
esac
